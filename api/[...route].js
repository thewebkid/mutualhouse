import { getApp } from '../server/app.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
};

export default async function handler(request) {
  const app = await getApp();
  return app.fetch(request);
}
