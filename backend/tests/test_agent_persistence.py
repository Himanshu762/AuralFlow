"""The agent must not forget what it learned when the process restarts."""

import os

import numpy as np
import pytest


def _experience(agent, reward: float = 1.0):
    state = agent.encode_state(
        current_mood=[0.5] * 5, recent_moods=[], time_of_day="evening", device_type="desktop"
    )
    agent.store_experience(
        state=state,
        action_song_mood=[0.8, 0.5, 0.8, 0.1, 0.8],
        reward=reward,
        next_state=state,
        done=True,
    )


def test_training_only_starts_once_the_batch_is_full(agent):
    for _ in range(10):
        _experience(agent)
    assert agent.train_step(batch_size=32) is None
    assert agent.training_steps == 0


def test_training_step_increments_and_decays_epsilon(agent):
    before = agent.epsilon
    for _ in range(40):
        _experience(agent)
    loss = agent.train_step(batch_size=32)
    assert loss is not None
    assert agent.training_steps == 1
    assert agent.epsilon < before


def test_checkpoint_round_trip_restores_learning(agent, tmp_path):
    """Weights, exploration rate, step count and replay buffer all survive."""
    for _ in range(40):
        _experience(agent)
    agent.train_step(batch_size=32)

    epsilon = agent.epsilon
    steps = agent.training_steps
    memory_size = len(agent.memory)
    weights = [p.detach().clone() for p in agent.policy_net.parameters()]

    path = str(tmp_path / "agent.pt")
    agent.save_model(path)
    assert os.path.isfile(path)

    # Simulate a restart: wipe everything the process was holding.
    agent.memory.clear()
    agent.training_steps = 0
    agent.epsilon = 0.3
    for p in agent.policy_net.parameters():
        p.data.zero_()

    assert agent.load_model(path) is True
    assert agent.epsilon == pytest.approx(epsilon)
    assert agent.training_steps == steps
    assert len(agent.memory) == memory_size
    for restored, original in zip(agent.policy_net.parameters(), weights):
        assert np.allclose(restored.detach().numpy(), original.numpy())


def test_missing_checkpoint_is_not_an_error(agent, tmp_path):
    assert agent.load_model(str(tmp_path / "nope.pt")) is False


def test_corrupt_checkpoint_is_ignored(agent, tmp_path):
    """A bad file must not take the service down on startup."""
    bad = tmp_path / "bad.pt"
    bad.write_text("this is not a torch checkpoint")
    assert agent.load_model(str(bad)) is False


def test_reward_reflects_engagement(agent):
    played = agent.compute_reward(
        was_played_fully=True, was_skipped=False, was_liked=True,
        was_replayed=False, play_duration_ratio=1.0,
    )
    skipped = agent.compute_reward(
        was_played_fully=False, was_skipped=True, was_liked=False,
        was_replayed=False, play_duration_ratio=0.05,
    )
    assert played > skipped


def test_scoring_is_reproducible(agent):
    """
    The policy network carries dropout, which PyTorch leaves switched on until
    the module is put in eval mode. Scoring a track has to be a pure function
    of its inputs — otherwise the same track ranks differently on every
    request and the listener sees recommendations reshuffle for no reason.
    """
    state = agent.encode_state(
        current_mood=[0.5] * 5, recent_moods=[], time_of_day="evening", device_type="desktop"
    )
    mood = [0.8, 0.5, 0.8, 0.1, 0.8]

    first = agent.score(state, mood)
    assert all(agent.score(state, mood) == first for _ in range(10))


def test_scoring_distinguishes_different_moods(agent):
    state = agent.encode_state(
        current_mood=[0.5] * 5, recent_moods=[], time_of_day="evening", device_type="desktop"
    )
    calm = agent.score(state, [0.1, 0.4, 0.1, 0.9, 0.7])
    loud = agent.score(state, [0.9, 0.8, 0.9, 0.1, 0.1])
    assert calm != loud


def test_batch_scoring_matches_single_scoring(agent):
    """
    Scoring several tracks at once must agree with scoring them one by one.

    The tolerance is absolute, not relative. Batched and single-row matrix
    multiplies take different BLAS paths and are not bit-identical, and a
    Q-value that happens to land near zero makes a relative tolerance
    impossibly tight — which made this test fail perhaps one run in ten. An
    absolute tolerance still catches a real mismatch, which would be orders of
    magnitude larger than this.
    """
    state = agent.encode_state(
        current_mood=[0.5] * 5, recent_moods=[], time_of_day="evening", device_type="desktop"
    )
    moods = [[0.1] * 5, [0.5] * 5, [0.9] * 5]
    assert agent.score_batch(state, moods) == pytest.approx(
        [agent.score(state, m) for m in moods], abs=1e-4
    )
    assert agent.score_batch(state, []) == []


def test_training_leaves_scoring_reproducible(agent):
    """Learning must not leave the network stuck in training mode."""
    state = agent.encode_state(
        current_mood=[0.5] * 5, recent_moods=[], time_of_day="evening", device_type="desktop"
    )
    for _ in range(40):
        _experience(agent)
    agent.train_step(batch_size=32)

    mood = [0.8, 0.5, 0.8, 0.1, 0.8]
    first = agent.score(state, mood)
    assert all(agent.score(state, mood) == first for _ in range(10))
