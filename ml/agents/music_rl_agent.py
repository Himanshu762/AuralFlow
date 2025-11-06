"""
Reinforcement Learning Agent for Music Recommendation

This agent learns user preferences through interaction:
- State: Current mood, recent songs, time of day, listening context
- Action: Select next song from candidate pool
- Reward: Based on user feedback (play full, skip, like, replay)

The agent uses a simple Q-learning approach with neural network function approximation.
"""

import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from typing import List, Dict, Tuple
from collections import deque
import random
import json


class MoodPolicyNetwork(nn.Module):
    """
    Neural network that learns the optimal policy for song selection

    Input: State representation (mood vector + context)
    Output: Q-values for each candidate song
    """

    def __init__(self, state_dim: int = 10, hidden_dim: int = 128):
        super(MoodPolicyNetwork, self).__init__()

        self.network = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1)  # Q-value for this state-action pair
        )

    def forward(self, state):
        """Forward pass to get Q-value"""
        return self.network(state)


class MusicRLAgent:
    """
    Reinforcement Learning agent for personalized music recommendation
    """

    def __init__(
        self,
        state_dim: int = 10,
        learning_rate: float = 0.001,
        gamma: float = 0.95,  # Discount factor
        epsilon: float = 0.3,  # Exploration rate
        epsilon_decay: float = 0.995,
        epsilon_min: float = 0.05,
        memory_size: int = 10000
    ):
        self.state_dim = state_dim
        self.gamma = gamma
        self.epsilon = epsilon
        self.epsilon_decay = epsilon_decay
        self.epsilon_min = epsilon_min

        # Neural network for Q-learning
        self.policy_net = MoodPolicyNetwork(state_dim=state_dim)
        self.optimizer = optim.Adam(self.policy_net.parameters(), lr=learning_rate)
        self.loss_fn = nn.MSELoss()

        # Experience replay memory
        self.memory = deque(maxlen=memory_size)

    def encode_state(
        self,
        current_mood: List[float],
        recent_moods: List[List[float]],
        time_of_day: str,
        device_type: str
    ) -> np.ndarray:
        """
        Encode the current state into a fixed-size vector

        State components:
        - Current mood vector (5 dims)
        - Average recent mood (5 dims)
        - Time of day (encoded as continuous 0-1)
        - Device type (encoded)

        Total: 10 dimensions
        """
        # Current mood (5 dims)
        state = list(current_mood)

        # Average of recent moods (5 dims)
        if recent_moods and len(recent_moods) > 0:
            avg_mood = np.mean(recent_moods, axis=0).tolist()
        else:
            avg_mood = [0.5] * 5
        state.extend(avg_mood)

        # Time of day encoding (0-1 continuous)
        time_encoding = {
            "morning": 0.25,
            "afternoon": 0.5,
            "evening": 0.75,
            "night": 1.0
        }.get(time_of_day, 0.5)

        # Device type encoding
        device_encoding = {
            "web": 0.33,
            "mobile": 0.66,
            "desktop": 1.0
        }.get(device_type, 0.5)

        state.append(time_encoding)
        state.append(device_encoding)

        return np.array(state, dtype=np.float32)

    def encode_action(self, song_mood: List[float]) -> np.ndarray:
        """
        Encode a candidate song (action) into a state-action representation

        For Q-learning, we concatenate state with action features
        """
        return np.array(song_mood, dtype=np.float32)

    def select_action(
        self,
        state: np.ndarray,
        candidate_songs: List[Dict],
        epsilon: float = None
    ) -> int:
        """
        Select the best song from candidates using epsilon-greedy policy

        Args:
            state: Current state encoding
            candidate_songs: List of dicts with 'mood_vector' and other metadata
            epsilon: Override exploration rate (if None, use self.epsilon)

        Returns:
            Index of selected song
        """
        if epsilon is None:
            epsilon = self.epsilon

        # Epsilon-greedy: explore vs exploit
        if random.random() < epsilon:
            # Explore: random selection
            return random.randint(0, len(candidate_songs) - 1)
        else:
            # Exploit: choose song with highest Q-value
            q_values = []
            with torch.no_grad():
                for song in candidate_songs:
                    # Combine state with song mood
                    song_mood = song.get('mood_vector', [0.5] * 5)
                    combined = np.concatenate([state, song_mood])
                    combined_tensor = torch.FloatTensor(combined)
                    q_value = self.policy_net(combined_tensor)
                    q_values.append(q_value.item())

            return int(np.argmax(q_values))

    def store_experience(
        self,
        state: np.ndarray,
        action_song_mood: List[float],
        reward: float,
        next_state: np.ndarray,
        done: bool
    ):
        """
        Store experience tuple in replay memory

        (state, action, reward, next_state, done)
        """
        self.memory.append({
            'state': state,
            'action': action_song_mood,
            'reward': reward,
            'next_state': next_state,
            'done': done
        })

    def compute_reward(
        self,
        was_played_fully: bool,
        was_skipped: bool,
        was_liked: bool,
        was_replayed: bool,
        play_duration_ratio: float
    ) -> float:
        """
        Compute reward based on user behavior

        Reward function:
        - +1.0: Liked or replayed
        - +0.5: Played fully (>80% of duration)
        - +0.2 to +0.5: Partial play (scaled by duration)
        - -1.0: Skipped early (<20% of duration)
        - -0.3: Skipped mid-song
        """
        if was_liked or was_replayed:
            return 1.0
        elif was_skipped:
            if play_duration_ratio < 0.2:
                return -1.0  # Skipped very early
            else:
                return -0.3  # Skipped mid-song
        elif was_played_fully or play_duration_ratio > 0.8:
            return 0.5
        else:
            # Partial play: scale reward by duration
            return 0.2 + (play_duration_ratio * 0.3)

    def train_step(self, batch_size: int = 32):
        """
        Perform one training step using experience replay

        Sample a batch from memory and update the policy network
        """
        if len(self.memory) < batch_size:
            return None

        # Sample batch
        batch = random.sample(self.memory, batch_size)

        # Prepare training data
        states = []
        targets = []

        for experience in batch:
            state = experience['state']
            action = experience['action']
            reward = experience['reward']
            next_state = experience['next_state']
            done = experience['done']

            # Current Q-value
            combined = np.concatenate([state, action])
            combined_tensor = torch.FloatTensor(combined)
            current_q = self.policy_net(combined_tensor)

            # Target Q-value (Bellman equation)
            if done:
                target_q = reward
            else:
                # Estimate max Q-value for next state
                # For simplicity, assume continuation with similar mood
                next_combined = torch.FloatTensor(np.concatenate([next_state, action]))
                with torch.no_grad():
                    next_q = self.policy_net(next_combined)
                target_q = reward + self.gamma * next_q.item()

            states.append(combined_tensor)
            targets.append(target_q)

        # Batch training
        states_batch = torch.stack(states)
        targets_batch = torch.FloatTensor(targets).unsqueeze(1)

        # Forward pass
        predictions = self.policy_net(states_batch)

        # Compute loss
        loss = self.loss_fn(predictions, targets_batch)

        # Backward pass
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()

        # Decay epsilon (reduce exploration over time)
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

        return loss.item()

    def save_model(self, path: str):
        """Save the trained model"""
        torch.save({
            'policy_net_state_dict': self.policy_net.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'epsilon': self.epsilon
        }, path)

    def load_model(self, path: str):
        """Load a trained model"""
        checkpoint = torch.load(path)
        self.policy_net.load_state_dict(checkpoint['policy_net_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.epsilon = checkpoint['epsilon']


# Global instance
rl_agent = MusicRLAgent()
