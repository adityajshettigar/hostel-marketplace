export const metadata = {
  title: 'gateway',
  description: 'Reverse-proxy gateway for the hostel marketplace microservices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
