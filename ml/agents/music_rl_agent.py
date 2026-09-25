"""
Reinforcement Learning Agent for Music Recommendation

The agent learns which track to play next from how the listener reacts:

- State:  the listener's current mood, the average of their recent moods, the
          mood the session's arc is heading toward, time of day and device.
- Action: the mood vector of a candidate track.
- Reward: play, skip, like, replay and how far into the track they got.

It is a Q-network over (state, action) pairs trained with experience replay.
Bootstrapping is SARSA-style: when the next track is known, the target uses
the Q-value of the transition actually taken rather than a max over actions
the agent never sees. That keeps the target grounded in real listening.
"""

import os
import random
from collections import deque
from typing import Dict, List, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim


# How much of the replay buffer a checkpoint carries. Enough to resume
# training immediately without writing a huge file every few tracks.
REPLAY_CHECKPOINT_LIMIT = 2000

CHECKPOINT_VERSION = 2

MOOD_DIMS = 5
NEUTRAL_MOOD = [0.5] * MOOD_DIMS

# current (5) + recent average (5) + arc target (5) + time (1) + device (1)
STATE_DIM = 17
INPUT_DIM = STATE_DIM + MOOD_DIMS


class MoodPolicyNetwork(nn.Module):
    """Q-network: state ++ action features in, one Q-value out."""

    def __init__(self, state_dim: int = INPUT_DIM, hidden_dim: int = 128):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, state):
        return self.network(state)


class MusicRLAgent:
    """Reinforcement Learning agent for personalised music recommendation."""

    def __init__(
        self,
        state_dim: int = INPUT_DIM,
        learning_rate: float = 0.001,
        gamma: float = 0.95,
        epsilon: float = 0.3,
        epsilon_decay: float = 0.995,
        epsilon_min: float = 0.05,
        memory_size: int = 10000,
    ):
        self.state_dim = state_dim
        self.gamma = gamma
        self.epsilon = epsilon
        self.epsilon_decay = epsilon_decay
        self.epsilon_min = epsilon_min

        self.policy_net = MoodPolicyNetwork(state_dim=state_dim)
        self.optimizer = optim.Adam(self.policy_net.parameters(), lr=learning_rate)
        self.loss_fn = nn.MSELoss()

        self.memory = deque(maxlen=memory_size)

        # Gradient steps taken across the agent's whole lifetime, including
        # everything restored from a checkpoint.
        self.training_steps = 0

    # ------------------------------------------------------------------ #
    # Encoding                                                           #
    # ------------------------------------------------------------------ #

    def encode_state(
        self,
        current_mood: List[float],
        recent_moods: List[List[float]],
        time_of_day: str,
        device_type: str,
        target_mood: Optional[List[float]] = None,
    ) -> np.ndarray:
        """
        Encode the listener's situation as a fixed-size vector.

        - current mood (5)
        - average of recent moods (5), neutral when there is no history
        - the mood the session arc is heading toward (5); defaults to the
          current mood, which means "hold"
        - time of day and device, each as one continuous value
        """
        state = list(_as_mood(current_mood))

        if recent_moods:
            avg_mood = np.mean([_as_mood(m) for m in recent_moods], axis=0).tolist()
        else:
            avg_mood = list(NEUTRAL_MOOD)
        state.extend(avg_mood)

        state.extend(_as_mood(target_mood if target_mood is not None else current_mood))

        time_encoding = {
            "morning": 0.25,
            "afternoon": 0.5,
            "evening": 0.75,
            "night": 1.0,
        }.get(time_of_day, 0.5)

        device_encoding = {
            "web": 0.33,
            "mobile": 0.66,
            "desktop": 1.0,
        }.get(device_type, 0.5)

        state.append(time_encoding)
        state.append(device_encoding)

        return np.array(state, dtype=np.float32)

    def encode_action(self, song_mood: List[float]) -> np.ndarray:
        return np.array(_as_mood(song_mood), dtype=np.float32)

    # ------------------------------------------------------------------ #
    # Acting                                                             #
    # ------------------------------------------------------------------ #

    def select_action(
        self,
        state: np.ndarray,
        candidate_songs: List[Dict],
        epsilon: Optional[float] = None,
    ) -> int:
        """Epsilon-greedy choice among candidates. Returns an index."""
        if not candidate_songs:
            raise ValueError("no candidates to choose from")
        if epsilon is None:
            epsilon = self.epsilon
        if random.random() < epsilon:
            return random.randint(0, len(candidate_songs) - 1)
        q_values = self.score_batch(
            state, [s.get("mood_vector", NEUTRAL_MOOD) for s in candidate_songs]
        )
        return int(np.argmax(q_values))

    def score(self, state: np.ndarray, song_mood: List[float]) -> float:
        """
        Q-value for playing a song with this mood in this state.

        The network carries dropout, which PyTorch leaves active until the
        module is put in eval mode. Scoring through this method rather than
        calling `policy_net` directly is what keeps a score reproducible.
        """
        return self.score_batch(state, [song_mood])[0]

    def score_batch(self, state: np.ndarray, song_moods: List[List[float]]) -> List[float]:
        """Q-values for several songs against one state. See `score`."""
        if not song_moods:
            return []

        was_training = self.policy_net.training
        self.policy_net.eval()
        try:
            batch = torch.FloatTensor(
                np.stack([np.concatenate([state, self.encode_action(m)]) for m in song_moods])
            )
            with torch.no_grad():
                return self.policy_net(batch).squeeze(-1).tolist()
        finally:
            if was_training:
                self.policy_net.train()

    # ------------------------------------------------------------------ #
    # Learning                                                           #
    # ------------------------------------------------------------------ #

    def store_experience(
        self,
        state: np.ndarray,
        action_song_mood: List[float],
        reward: float,
        next_state: np.ndarray,
        done: bool,
        next_action_song_mood: Optional[List[float]] = None,
    ):
        """
        Store a transition.

        `next_action_song_mood` is the mood of the track that actually played
        next, when known. The bootstrap target then uses the transition the
        listener really took.
        """
        self.memory.append(
            {
                "state": np.asarray(state, dtype=np.float32),
                "action": list(_as_mood(action_song_mood)),
                "reward": float(reward),
                "next_state": np.asarray(next_state, dtype=np.float32),
                "done": bool(done),
                "next_action": (
                    list(_as_mood(next_action_song_mood))
                    if next_action_song_mood is not None
                    else None
                ),
            }
        )

    def compute_reward(
        self,
        was_played_fully: bool,
        was_skipped: bool,
        was_liked: bool,
        was_replayed: bool,
        play_duration_ratio: float,
    ) -> float:
        """
        Reward from listening behaviour.

        - +1.0  liked or replayed
        - +0.5  played fully (>80% of duration)
        - +0.2 to +0.5  partial play, scaled by how far they got
        - -0.3  skipped mid-song
        - -1.0  skipped early (<20% of duration)
        """
        if was_liked or was_replayed:
            return 1.0
        if was_skipped:
            return -1.0 if play_duration_ratio < 0.2 else -0.3
        if was_played_fully or play_duration_ratio > 0.8:
            return 0.5
        return 0.2 + (max(0.0, min(1.0, play_duration_ratio)) * 0.3)

    def train_step(self, batch_size: int = 32):
        """One gradient step over a replay sample. Returns the loss, or None."""
        if len(self.memory) < batch_size:
            return None

        batch = random.sample(self.memory, batch_size)

        inputs = np.stack(
            [np.concatenate([e["state"], self.encode_action(e["action"])]) for e in batch]
        )

        # Bootstrapped targets are estimates, not something to learn through:
        # take them without dropout so the target is stable step to step.
        next_inputs = np.stack(
            [
                np.concatenate(
                    [e["next_state"], self.encode_action(e["next_action"] or e["action"])]
                )
                for e in batch
            ]
        )
        self.policy_net.eval()
        with torch.no_grad():
            next_q = self.policy_net(torch.FloatTensor(next_inputs)).squeeze(-1).numpy()

        rewards = np.array([e["reward"] for e in batch], dtype=np.float32)
        continues = np.array([0.0 if e["done"] else 1.0 for e in batch], dtype=np.float32)
        targets = rewards + self.gamma * next_q * continues

        # Forward pass with dropout — this is the only place it belongs.
        self.policy_net.train()
        predictions = self.policy_net(torch.FloatTensor(inputs))
        loss = self.loss_fn(predictions, torch.FloatTensor(targets).unsqueeze(1))

        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        self.policy_net.eval()

        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)
        self.training_steps += 1

        return loss.item()

    # ------------------------------------------------------------------ #
    # Persistence                                                        #
    # ------------------------------------------------------------------ #

    def save_model(self, path: str):
        """
        Write a checkpoint atomically.

        Saves the weights, optimizer state, exploration rate, lifetime step
        count and a bounded slice of the replay buffer.
        """
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        recent = list(self.memory)[-REPLAY_CHECKPOINT_LIMIT:]

        tmp = f"{path}.tmp"
        torch.save(
            {
                "version": CHECKPOINT_VERSION,
                "state_dim": self.state_dim,
                "policy_net_state_dict": self.policy_net.state_dict(),
                "optimizer_state_dict": self.optimizer.state_dict(),
                "epsilon": self.epsilon,
                "training_steps": self.training_steps,
                "memory": recent,
            },
            tmp,
        )
        os.replace(tmp, path)

    def load_model(self, path: str) -> bool:
        """
        Restore a checkpoint. Returns False when there is nothing to load.

        A checkpoint from an incompatible build — a different state layout,
        an unreadable file — is ignored rather than crashing the service; the
        agent simply starts fresh.
        """
        if not os.path.isfile(path):
            return False

        try:
            checkpoint = torch.load(path, map_location="cpu", weights_only=False)
            if checkpoint.get("state_dim", 17) != self.state_dim:
                print(
                    f"[rl_agent] checkpoint {path} was written for a different state "
                    f"layout ({checkpoint.get('state_dim')} vs {self.state_dim}); starting fresh"
                )
                return False
            self.policy_net.load_state_dict(checkpoint["policy_net_state_dict"])
            self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
            self.epsilon = checkpoint.get("epsilon", self.epsilon)
            self.training_steps = checkpoint.get("training_steps", 0)
            for experience in checkpoint.get("memory", []):
                experience.setdefault("next_action", None)
                self.memory.append(experience)
            return True
        except Exception as e:  # noqa: BLE001 — a bad checkpoint must not be fatal
            print(f"[rl_agent] ignoring unreadable checkpoint {path}: {e}")
            return False


def _as_mood(vector) -> List[float]:
    """Coerce anything mood-shaped to five floats in [0, 1]."""
    values = [float(v) for v in (vector or [])][:MOOD_DIMS]
    while len(values) < MOOD_DIMS:
        values.append(0.5)
    return [max(0.0, min(1.0, v)) for v in values]


# Global instance
rl_agent = MusicRLAgent()
