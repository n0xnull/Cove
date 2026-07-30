import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cove — Panel Pengawasan Orang Tua',
  description: 'Dashboard pemantauan parental real-time — Cove by NoxNull',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/cove-icon-256.png', type: 'image/png', sizes: '256x256' },
    ],
    apple: '/cove-icon-256.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
