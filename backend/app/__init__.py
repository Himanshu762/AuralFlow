"""
AuralFlow backend package.

The RL agent lives in the repo-level `ml` package, beside `backend/`. Make it
importable from anywhere in the app without every module having to know
where it sits — including when uvicorn is started from the backend directory
by the desktop shell.
"""

import os
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
