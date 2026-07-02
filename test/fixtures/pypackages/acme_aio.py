"""Executable counterpart of the @acme/aio fixture provider package."""


async def fetch_text(key):
    return "aio:" + key
