import { defineConfig } from 'astro/config';
import inlineReview from 'review-loop';

export default defineConfig({
  integrations: [inlineReview()],
});
