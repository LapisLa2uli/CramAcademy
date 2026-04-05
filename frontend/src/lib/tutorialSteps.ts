export interface TutorialStep {
  /** CSS selector targeting the element to highlight */
  selector: string;
  /** Tooltip text */
  content: string;
  /** Preferred tooltip position relative to the target */
  position: "top" | "bottom" | "left" | "right";
}

const dashboardSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="main-tabs"]',
    content: "Switch between taking tests and contributing questions using these tabs.",
    position: "bottom",
  },
  {
    selector: '[data-tutorial="test-config"]',
    content: "Configure your test here: choose a subject, difficulty, number of questions, and time limit.",
    position: "right",
  },
  {
    selector: '[data-tutorial="generate-btn"]',
    content: "Click Generate to create a new test based on your settings.",
    position: "top",
  },
  {
    selector: '[data-tutorial="recent-tests"]',
    content: "Your recent tests appear here. Click any to view results or resume.",
    position: "top",
  },
];

const contributeSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="main-tabs"]',
    content: "Switch to 'Contribute Questions' to create questions for the community.",
    position: "bottom",
  },
  {
    selector: '[data-tutorial="contribute-tabs"]',
    content:
      "Choose how to create questions: type them in a form, upload a PDF/image, or create a question set (group of related questions sharing a passage).",
    position: "bottom",
  },
];

const myBankSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="bank-list"]',
    content: "All questions you've created appear here, grouped by status.",
    position: "top",
  },
  {
    selector: '[data-tutorial="submit-review-btn"]',
    content: "Submit a personal question for moderator review to get it published to the community pool.",
    position: "left",
  },
];

const moderationQueueSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="queue-list"]',
    content: "Questions awaiting your review. Check each for quality and accuracy.",
    position: "top",
  },
  {
    selector: '[data-tutorial="approve-btn"]',
    content: "Approve to publish the question to the community pool. The author earns contribution points.",
    position: "left",
  },
  {
    selector: '[data-tutorial="reject-btn"]',
    content: "Reject with a reason — the question returns to the author's bank with your feedback.",
    position: "left",
  },
];

const communityBankSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="community-list"]',
    content: "All published community questions. Question sets are grouped together — click to expand.",
    position: "top",
  },
  {
    selector: '[data-tutorial="edit-btn"]',
    content: "Click Edit to modify a question's subject, content, or other details.",
    position: "left",
  },
];

const adminSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="user-list"]',
    content: "Manage all registered users. Change roles or remove accounts.",
    position: "top",
  },
  {
    selector: '[data-tutorial="subjects-link"]',
    content: "Manage the global list of subjects and their levels.",
    position: "bottom",
  },
];

const profileSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="profile-avatar"]',
    content: "Your avatar — click to upload a new one.",
    position: "right",
  },
  {
    selector: '[data-tutorial="profile-username"]',
    content: "Edit your public username displayed across the site.",
    position: "bottom",
  },
  {
    selector: '[data-tutorial="contribution-heatmap"]',
    content: "Your contribution activity over time. Earn points by getting questions approved.",
    position: "top",
  },
];

const testPageSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="test-timer"]',
    content: "Your remaining time. The test auto-submits when time runs out.",
    position: "bottom",
  },
  {
    selector: '[data-tutorial="nav-panel"]',
    content: "Navigate between questions. Green = answered, orange = flagged for review.",
    position: "right",
  },
  {
    selector: '[data-tutorial="flag-btn"]',
    content: "Flag a question to come back to later before submitting.",
    position: "top",
  },
  {
    selector: '[data-tutorial="submit-test-btn"]',
    content: "Submit your test when you're ready. You can submit early.",
    position: "bottom",
  },
];

const resultsPageSteps: TutorialStep[] = [
  {
    selector: '[data-tutorial="results-summary"]',
    content: "Your overall score and test summary.",
    position: "bottom",
  },
  {
    selector: '[data-tutorial="results-questions"]',
    content: "Review each question, your answer, and the correct answer. Click to expand details.",
    position: "top",
  },
];

interface PageTutorial {
  match: (pathname: string) => boolean;
  steps: TutorialStep[];
}

const tutorials: PageTutorial[] = [
  { match: (p) => p === "/dashboard", steps: dashboardSteps },
  { match: (p) => p === "/dashboard/my-bank", steps: myBankSteps },
  { match: (p) => p === "/dashboard/moderation/queue", steps: moderationQueueSteps },
  { match: (p) => p === "/dashboard/moderation/community", steps: communityBankSteps },
  { match: (p) => p === "/dashboard/admin", steps: adminSteps },
  { match: (p) => p === "/dashboard/profile", steps: profileSteps },
  { match: (p) => p.startsWith("/test/"), steps: testPageSteps },
  { match: (p) => p.startsWith("/results/"), steps: resultsPageSteps },
];

export function getTutorialForPath(pathname: string): TutorialStep[] | null {
  const found = tutorials.find((t) => t.match(pathname));
  return found?.steps ?? null;
}

export { contributeSteps };
