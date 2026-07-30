import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cove — Panel Pengawasan Orang Tua',
  description: 'Dashboard pemantauan parental real-time — Cove by NoxNull',
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
