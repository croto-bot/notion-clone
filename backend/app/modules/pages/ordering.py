"""Fractional indexing: order keys that sort between two neighbours.

Port of the reference algorithm (rocicorp/fractional-indexing, CC0; based on
https://observablehq.com/@dgreensp/implementing-fractional-indexing). A key is
an integer part (a head character that encodes the digit-run length, followed
by digits) plus a fractional part. ``generate_key_between(a, b)`` returns a
key strictly between ``a`` and ``b`` (either may be None = unbounded), so
sibling order never renumbers the other siblings.

The default alphabet is base 62 with the classic A-Z/a-z heads: the first
key is "a0", and keys grow lazily in both directions.
"""

from __future__ import annotations

BASE_62_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE_52_DIGITS = BASE_62_DIGITS[10:]


def _midpoint(a: str, b: str | None, digits: str) -> str:
    """Return a string strictly between ``a`` and ``b`` (a < b)."""
    zero = digits[0]
    if b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")
    if a.endswith(zero) or (b is not None and b.endswith(zero)):
        raise ValueError("trailing zero")
    if b is not None:
        # Remove the longest common prefix, padding `a` with 0s as we go.
        n = 0
        while (a[n] if n < len(a) else zero) == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:], digits)

    digit_a = digits.index(a[0]) if a else 0
    digit_b = digits.index(b[0]) if b is not None else len(digits)
    if digit_b - digit_a > 1:
        mid_digit = round(0.5 * (digit_a + digit_b))
        return digits[mid_digit]
    if b is not None and len(b) > 1:
        return b[:1]
    # `b` is None or a single digit: append to `a`'s fraction, growing it.
    return digits[digit_a] + _midpoint(a[1:] if len(a) > 1 else "", None, digits)


def _integer_length(head: str, int_digits: str) -> int:
    index = int_digits.index(head)
    half = len(int_digits) // 2
    if index < half:
        return half - index + 1
    return index - half + 2


def _integer_part(key: str, int_digits: str) -> str:
    length = _integer_length(key[0], int_digits)
    if length > len(key):
        raise ValueError(f"invalid order key: {key}")
    return key[:length]


def _validate_order_key(key: str, digits: str, int_digits: str) -> None:
    smallest = int_digits[0] + digits[0] * (len(int_digits) // 2)
    if key == smallest:
        raise ValueError(f"invalid order key: {key}")
    integer = _integer_part(key, int_digits)
    fraction = key[len(integer) :]
    if fraction.endswith(digits[0]):
        raise ValueError(f"invalid order key: {key}")


def _increment_integer(x: str, digits: str, int_digits: str) -> str | None:
    head = x[0]
    zero = digits[0]
    trailing = ""
    for i in range(len(x) - 1, 0, -1):
        d = digits.index(x[i]) + 1
        if d == len(digits):
            trailing = zero + trailing
        else:
            return head + x[1:i] + digits[d] + trailing
    head_index = int_digits.index(head)
    if head_index == len(int_digits) - 1:
        return None  # already the largest integer
    new_head = int_digits[head_index + 1]
    delta = _integer_length(new_head, int_digits) - _integer_length(head, int_digits)
    if delta > 0:
        return new_head + trailing + zero
    if delta < 0:
        return new_head + trailing[1:]
    return new_head + trailing


def _decrement_integer(x: str, digits: str, int_digits: str) -> str | None:
    head = x[0]
    last = digits[-1]
    trailing = ""
    for i in range(len(x) - 1, 0, -1):
        d = digits.index(x[i]) - 1
        if d == -1:
            trailing = last + trailing
        else:
            return head + x[1:i] + digits[d] + trailing
    head_index = int_digits.index(head)
    if head_index == 0:
        return None  # already the smallest integer
    new_head = int_digits[head_index - 1]
    delta = _integer_length(new_head, int_digits) - _integer_length(head, int_digits)
    if delta > 0:
        return new_head + trailing + last
    if delta < 0:
        return new_head + trailing[1:]
    return new_head + trailing


def generate_key_between(a: str | None, b: str | None) -> str:
    """Return an order key between ``a`` and ``b`` (either may be None)."""
    digits = BASE_62_DIGITS
    int_digits = BASE_52_DIGITS
    if a is not None:
        _validate_order_key(a, digits, int_digits)
    if b is not None:
        _validate_order_key(b, digits, int_digits)
    if a is not None and b is not None and a > b:
        a, b = b, a

    if a is None:
        if b is None:
            return f"{int_digits[len(int_digits) // 2]}{digits[0]}"  # "a0"
        integer_b = _integer_part(b, int_digits)
        fraction_b = b[len(integer_b) :]
        smallest = int_digits[0] + digits[0] * (len(int_digits) // 2)
        if integer_b == smallest:
            return integer_b + _midpoint("", fraction_b, digits)
        if integer_b < b:
            return integer_b
        result = _decrement_integer(integer_b, digits, int_digits)
        if result is None:
            raise ValueError("cannot decrement any more")
        return result

    if b is None:
        integer_a = _integer_part(a, int_digits)
        fraction_a = a[len(integer_a) :]
        incremented = _increment_integer(integer_a, digits, int_digits)
        if incremented is None:
            return integer_a + _midpoint(fraction_a, None, digits)
        return incremented

    integer_a = _integer_part(a, int_digits)
    fraction_a = a[len(integer_a) :]
    integer_b = _integer_part(b, int_digits)
    fraction_b = b[len(integer_b) :]
    if integer_a == integer_b:
        return integer_a + _midpoint(fraction_a, fraction_b, digits)
    incremented = _increment_integer(integer_a, digits, int_digits)
    if incremented is None:
        raise ValueError("cannot increment any more")
    if incremented < b:
        return incremented
    return integer_a + _midpoint(fraction_a, None, digits)
