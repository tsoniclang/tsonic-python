"""Fake provider runtime counterpart for the @acme/files test package."""


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()
