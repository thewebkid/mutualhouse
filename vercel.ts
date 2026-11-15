import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    routes.rewrite('/api/(.*)', '/api/[...route]'),
    routes.rewrite('/mcp/(.*)', '/api/[...route]'),
    routes.rewrite('/oauth2/(.*)', '/api/[...route]'),
    routes.rewrite('/.well-known/(.*)', '/api/[...route]'),
    routes.rewrite('/((?!api/|mcp/|oauth2/|\\.well-known/|assets/|manifest\\.webmanifest|sw\\.js|workbox-).*)' , '/index.html'),
  ],
};
