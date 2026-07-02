"""Fake provider runtime counterpart for the @acme/vectors test package."""


class Vector:
    def __init__(self, x, y):
        self._components = [x, y]

    def __getitem__(self, index):
        return self._components[index]
