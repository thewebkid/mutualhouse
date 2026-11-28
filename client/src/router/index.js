import { createRouter, createWebHistory } from 'vue-router';
import { globalState } from '../lib/state.js';
import { loadSessionAndHouses } from '../lib/mut/house-orchestration.js';

const routes = [
  {
    path: '/',
    name: 'porch',
    component: () => import('../pages/PorchHomePage.vue'),
  },
  {
    path: '/orientation',
    name: 'orientation',
    component: () => import('../pages/OrientationPage.vue'),
  },
  {
    path: '/compact',
    name: 'compact',
    component: () => import('../pages/CompactPage.vue'),
  },
  {
    path: '/disclosures',
    name: 'disclosures',
    component: () => import('../pages/DisclosuresPage.vue'),
  },
  {
    path: '/brief/ai-landscape',
    name: 'stakeholder-brief',
    component: () => import('../pages/StakeholderBriefPage.vue'),
  },
  {
    path: '/sign-in',
    name: 'sign-in',
    component: () => import('../pages/SignInPage.vue'),
  },
  {
    path: '/auth/verify',
    name: 'auth-verify',
    component: () => import('../pages/SignInPage.vue'),
  },
  {
    path: '/houses',
    name: 'houses',
    component: () => import('../pages/HousesHubPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/houses/new',
    name: 'create-house',
    component: () => import('../pages/CreateHousePage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/invite/:token',
    name: 'invite-accept',
    component: () => import('../pages/InviteAcceptPage.vue'),
  },
  {
    path: '/oauth/consent',
    name: 'oauth-consent',
    component: () => import('../pages/OAuthConsentPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/house/:slug/:roomSlug?',
    name: 'house-shell',
    component: () => import('../pages/HouseShellPage.vue'),
    meta: { requiresAuth: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth' };
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  if (!globalState.authReady) {
    await loadSessionAndHouses();
  }
  if (to.meta.requiresAuth && !globalState.currentUser) {
    return { name: 'sign-in', query: { redirect: to.fullPath } };
  }
  return true;
});
