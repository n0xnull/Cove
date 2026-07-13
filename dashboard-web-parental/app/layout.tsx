import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Silent Guardian — Panel Pengawasan Orang Tua',
  description: 'Dashboard pemantauan parental real-time v2 — Silent Guardian',
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
