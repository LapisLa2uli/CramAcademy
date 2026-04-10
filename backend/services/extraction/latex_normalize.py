"""Safety-net converter: translate stray Unicode math symbols to LaTeX.

The extraction prompt instructs the vision model to emit LaTeX for all math,
but models sometimes fall back to Unicode (``π``, ``²``, ``≤``, ``√`` …).
This module provides a best-effort post-processor that:

1. Preserves any text already wrapped in a math environment (``$...$``,
   ``$$...$$``, ``\\(...\\)``, ``\\[...\\]``) and simply substitutes Unicode
   math characters found inside it with their LaTeX command equivalents.
2. For text outside math environments, wraps each Unicode math character
   individually in ``$...$`` and then merges adjacent single-character wraps
   so that sequences like ``π²`` collapse to ``$\\pi^{2}$``.

It is intentionally simple — the primary fix for "unicode instead of LaTeX"
lives in the extraction prompt. This module just prevents the worst-case
leakage from reaching the database.
"""

from __future__ import annotations

import re
from typing import Iterable


# Mapping from a Unicode math character to its LaTeX replacement.
# For Greek letters and relations we use commands that work inside a math env.
# For superscripts/subscripts we use ``^{n}`` / ``_{n}`` so they compose cleanly
# when we merge adjacent wraps.
_MATH_SYMBOL_MAP: dict[str, str] = {
    # Lowercase Greek
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta",
    "ε": r"\varepsilon", "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta",
    "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda", "μ": r"\mu",
    "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho",
    "σ": r"\sigma", "ς": r"\varsigma", "τ": r"\tau", "υ": r"\upsilon",
    "φ": r"\varphi", "ϕ": r"\phi", "χ": r"\chi", "ψ": r"\psi", "ω": r"\omega",
    # Uppercase Greek
    "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "Λ": r"\Lambda",
    "Ξ": r"\Xi", "Π": r"\Pi", "Σ": r"\Sigma", "Υ": r"\Upsilon",
    "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
    # Relations
    "≤": r"\leq", "≥": r"\geq", "≠": r"\neq", "≈": r"\approx",
    "≡": r"\equiv", "≅": r"\cong", "∼": r"\sim", "∝": r"\propto",
    # Binary operators
    "±": r"\pm", "∓": r"\mp", "×": r"\times", "÷": r"\div",
    "·": r"\cdot", "∙": r"\cdot", "∘": r"\circ", "⋅": r"\cdot",
    # Arrows
    "→": r"\to", "←": r"\leftarrow", "↔": r"\leftrightarrow",
    "⇒": r"\Rightarrow", "⇐": r"\Leftarrow", "⇔": r"\Leftrightarrow",
    "↦": r"\mapsto",
    # Sets
    "∈": r"\in", "∉": r"\notin", "∋": r"\ni",
    "⊂": r"\subset", "⊆": r"\subseteq", "⊃": r"\supset", "⊇": r"\supseteq",
    "∪": r"\cup", "∩": r"\cap", "∅": r"\emptyset", "∖": r"\setminus",
    # Calculus / analysis
    "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla",
    "∑": r"\sum", "∏": r"\prod", "∫": r"\int", "∮": r"\oint",
    "√": r"\sqrt{}", "∛": r"\sqrt[3]{}", "∜": r"\sqrt[4]{}",
    # Geometry
    "∥": r"\parallel", "⊥": r"\perp", "∠": r"\angle", "°": r"^{\circ}",
    "△": r"\triangle", "□": r"\square",
    # Logic / quantifiers
    "∀": r"\forall", "∃": r"\exists", "¬": r"\neg",
    "∧": r"\land", "∨": r"\lor",
    # Superscripts
    "⁰": "^{0}", "¹": "^{1}", "²": "^{2}", "³": "^{3}", "⁴": "^{4}",
    "⁵": "^{5}", "⁶": "^{6}", "⁷": "^{7}", "⁸": "^{8}", "⁹": "^{9}",
    "⁺": "^{+}", "⁻": "^{-}", "⁼": "^{=}", "⁽": "^{(}", "⁾": "^{)}",
    "ⁿ": "^{n}", "ⁱ": "^{i}",
    # Subscripts
    "₀": "_{0}", "₁": "_{1}", "₂": "_{2}", "₃": "_{3}", "₄": "_{4}",
    "₅": "_{5}", "₆": "_{6}", "₇": "_{7}", "₈": "_{8}", "₉": "_{9}",
    "₊": "_{+}", "₋": "_{-}", "₌": "_{=}", "₍": "_{(}", "₎": "_{)}",
    "ₙ": "_{n}", "ᵢ": "_{i}", "ⱼ": "_{j}", "ₖ": "_{k}",
    # Fractions (rare, but seen)
    "½": r"\tfrac{1}{2}", "⅓": r"\tfrac{1}{3}", "⅔": r"\tfrac{2}{3}",
    "¼": r"\tfrac{1}{4}", "¾": r"\tfrac{3}{4}",
}

# Inside an existing math environment we don't want empty ``\sqrt{}`` — just
# emit ``\sqrt`` with a trailing space so whatever follows becomes the radicand.
_MATH_SYMBOL_MAP_INSIDE: dict[str, str] = {
    **_MATH_SYMBOL_MAP,
    "√": r"\sqrt ",
    "∛": r"\sqrt[3] ",
    "∜": r"\sqrt[4] ",
}

# Matches an already-delimited math environment so we leave its contents alone
# apart from substituting Unicode symbols inside it.
_MATH_ENV = re.compile(
    r"(\$\$.+?\$\$|\$[^$\n]+?\$|\\\(.+?\\\)|\\\[.+?\\\])",
    re.DOTALL,
)


def _replace_inside_math(text: str) -> str:
    for uni, lat in _MATH_SYMBOL_MAP_INSIDE.items():
        if uni in text:
            text = text.replace(uni, lat)
    return text


def _wrap_outside_math(text: str) -> str:
    if not any(c in _MATH_SYMBOL_MAP for c in text):
        return text
    buf: list[str] = []
    for c in text:
        lat = _MATH_SYMBOL_MAP.get(c)
        if lat is None:
            buf.append(c)
        else:
            buf.append(f"${lat}$")
    joined = "".join(buf)
    # Merge adjacent ``$A$$B$`` -> ``$AB$``. Repeat until no further merges,
    # so runs like ``π²`` (two adjacent wraps) collapse into a single ``$\pi^{2}$``.
    merge_re = re.compile(r"\$([^$]*)\$\$([^$]*)\$")
    while True:
        new = merge_re.sub(r"$\1\2$", joined)
        if new == joined:
            break
        joined = new
    return joined


def unicode_to_latex(text: str | None) -> str:
    """Convert stray Unicode math symbols to LaTeX.

    Preserves existing math environments. Returns the input unchanged when it
    is empty or contains no known math Unicode characters.
    """
    if not text:
        return text or ""
    if not any(c in _MATH_SYMBOL_MAP for c in text):
        return text

    out: list[str] = []
    last = 0
    for m in _MATH_ENV.finditer(text):
        if m.start() > last:
            out.append(_wrap_outside_math(text[last : m.start()]))
        out.append(_replace_inside_math(m.group(0)))
        last = m.end()
    if last < len(text):
        out.append(_wrap_outside_math(text[last:]))
    return "".join(out)


def normalize_option(opt: dict) -> dict:
    """Return a copy of an MCQ option dict with its ``text`` LaTeX-normalized."""
    if not isinstance(opt, dict):
        return opt
    new = dict(opt)
    if isinstance(new.get("text"), str):
        new["text"] = unicode_to_latex(new["text"])
    return new


def normalize_options(options: Iterable[dict] | None) -> list[dict] | None:
    if options is None:
        return None
    return [normalize_option(o) for o in options]
