"""Unit tests for AP-style PDF fingerprinting, post-process, and validation."""

from __future__ import annotations

import unittest

from schemas.extraction import (
    ExtractionQuestionDraft,
    ExtractionSetDraft,
    PdfDocumentProfile,
    PdfPageSegment,
    SharedStemDraft,
)
from services.extraction.ap_extraction_postprocess import (
    apply_canonical_postprocess,
    apply_world_shared_stems_from_text,
    join_soft_hyphen_linebreaks,
)
from services.extraction.ap_extraction_validate import validate_extraction_structure
from services.extraction.pdf_document_profile import build_document_profile, classify_page_text


class TestFingerprint(unittest.TestCase):
    def test_marco_lang(self) -> None:
        text0 = "Visit www.marcolearning.com\nUSE THIS SHEET TO RECORD YOUR ANSWERS"
        text2 = "AP® ENGLISH LANGUAGE AND COMPOSITION\nSection I"
        pages = {0: text0, 1: text2}
        p = build_document_profile(pages, max_pages_index=3)
        self.assertEqual(p.family, "marco_ap_lang")
        self.assertEqual(p.expected_mcq_choice_count, 5)
        self.assertTrue("marco_branding" in p.signals or "ap_english_language" in p.signals)

    def test_world(self) -> None:
        blob = "© 2017 The College Board\nAP® World History Practice Exam\nSection I, Part A"
        pages = {0: blob, 5: "Questions 1–3 refer to the passage below.\nHello"}
        p = build_document_profile(pages, max_pages_index=6)
        self.assertEqual(p.family, "college_board_world")
        self.assertEqual(p.expected_mcq_choice_count, 4)

    def test_calc(self) -> None:
        blob = "The College Board\nAP® Calculus BC\nPractice Exam\nSection I"
        pages = {0: blob}
        p = build_document_profile(pages, max_pages_index=1)
        self.assertEqual(p.family, "college_board_calc")


class TestPageRoles(unittest.TestCase):
    def test_answer_sheet(self) -> None:
        t = "USE THIS SHEET TO RECORD YOUR ANSWERS FOR THE EXAM."
        self.assertEqual(classify_page_text(t, 0), "answer_sheet")

    def test_scoring(self) -> None:
        t = "AP® Calculus BC\nFree-Response Scoring Guidelines\nQuestion 1"
        self.assertEqual(classify_page_text(t, 40), "scoring")


class TestHyphenJoin(unittest.TestCase):
    def test_join(self) -> None:
        s = "calami-\ntous effects"
        self.assertEqual(join_soft_hyphen_linebreaks(s), "calamitous effects")


class TestWorldStems(unittest.TestCase):
    def test_backfill(self) -> None:
        pdf_text = {
            0: "Questions 1–3 refer to the passage below.\nStem paragraph here.\n1.\tFirst?",
        }
        sets = [
            ExtractionSetDraft(
                set_index=0,
                questions=[
                    ExtractionQuestionDraft(question_index=1, type="mcq", content="Q1"),
                    ExtractionQuestionDraft(question_index=2, type="mcq", content="Q2"),
                ],
            )
        ]
        out = apply_world_shared_stems_from_text(sets, pdf_text, max_page=1)
        self.assertTrue(out[0].shared_stems)
        nums = out[0].shared_stems[0].applies_to_question_numbers
        self.assertEqual(nums, [1, 2, 3])


class TestPostprocessHyphenMarco(unittest.TestCase):
    def test_marco_cleanup(self) -> None:
        profile = PdfDocumentProfile(family="marco_ap_lang", pages=[PdfPageSegment(page_index=0)])
        sets = [
            ExtractionSetDraft(
                set_index=0,
                context_text="",
                questions=[
                    ExtractionQuestionDraft(
                        question_index=1,
                        type="mcq",
                        content="exam-\nple",
                        options=[{"label": "A", "text": "x"}],
                        answer="A",
                    )
                ],
            )
        ]
        out = apply_canonical_postprocess(sets, profile, {}, max_page=1)
        self.assertIn("example", out[0].questions[0].content.replace(" ", ""))


class TestValidate(unittest.TestCase):
    def test_empty_options_flag(self) -> None:
        profile = PdfDocumentProfile(
            family="college_board_calc",
            expected_mcq_choice_count=5,
            pages=[PdfPageSegment(page_index=0)],
        )
        sets = [
            ExtractionSetDraft(
                set_index=0,
                source_page_indices=[0],
                questions=[
                    ExtractionQuestionDraft(
                        question_index=1,
                        type="mcq",
                        content="$x$",
                        options=[],
                        answer="",
                    )
                ],
            )
        ]
        w, retry = validate_extraction_structure(sets, profile)
        self.assertTrue(any("no options" in x.lower() for x in w))
        self.assertIn(0, retry)
