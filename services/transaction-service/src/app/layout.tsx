export const metadata = {
  title: 'transaction-service',
  description: 'Escrow, handover and dispute lifecycle for the hostel marketplace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
