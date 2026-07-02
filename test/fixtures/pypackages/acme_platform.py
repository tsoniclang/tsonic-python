"""Fake provider runtime counterpart for the @acme/platform test package."""


class Env:
    @property
    def home_dir(self):
        # Deterministic stub so runtime-proof tests are environment-independent.
        return "/home/acme"
