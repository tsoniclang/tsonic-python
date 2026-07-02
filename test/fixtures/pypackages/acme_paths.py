"""Executable counterpart of the @acme/paths fixture provider package."""


class FilePath:
    sep = "/"

    def __init__(self, text):
        self._text = text

    @property
    def suffix(self):
        index = self._text.rfind(".")
        return self._text[index:] if index >= 0 else ""

    def with_suffix(self, next):
        base = self._text
        index = base.rfind(".")
        if index >= 0:
            base = base[:index]
        return FilePath(base + next)
