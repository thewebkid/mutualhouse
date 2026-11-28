import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    routes.rewrite('/api/(.*)', '/api/index?__mh_path=/api/$1'),
    routes.rewrite('/mcp/(.*)', '/api/index?__mh_path=/mcp/$1'),
    routes.rewrite('/oauth2/(.*)', '/api/index?__mh_path=/oauth2/$1'),
    routes.rewrite('/.well-known/(.*)', '/api/index?__mh_path=/.well-known/$1'),
    routes.rewrite('/welcome.md', '/api/index?__mh_path=/welcome.md'),
    routes.rewrite(
      '/((?!api/|mcp/|oauth2/|\\.well-known/|welcome\\.md$|assets/|brand/|manifest\\.webmanifest|sw\\.js|registerSW\\.js|workbox-).*)',
      '/index.html'
    ),
  ],
};
