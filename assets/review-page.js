import { trackPageView } from "./visitor-tracker.js";

function trackReviewVisit() {
  trackPageView("review_page");
}

trackReviewVisit();

