import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

import stylesUrl from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    links: [
      { rel: 'stylesheet', href: stylesUrl },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'Fleet' },
      {
        name: 'description',
        content: 'Send a fleet of research agents after any question.',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
  notFoundComponent: FleetNotFound,
})

function FleetNotFound() {
  return (
    <main className="not-found">
      <span className="fleet-glyph" aria-hidden="true">F</span>
      <h1>This route is outside the fleet.</h1>
      <a href="/">Return to research</a>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
