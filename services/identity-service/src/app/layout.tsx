import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'identity-service',
  description: 'Smart Hostel Marketplace — identity-service',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
