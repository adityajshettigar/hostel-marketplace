export const metadata = {
  title: 'communication-service',
  description: 'Chat, chat-safety and notifications for hostel-marketplace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
