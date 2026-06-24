import '@/app/globals.css';

export const metadata = {
  title: 'FA2I - Plateforme de Vote',
  description: 'Fédération des Associations Ivoiriennes en Inde - Système de Vote Sécurisé',
  icons: {
    icon: '/fa2i-logo.jpg',
    shortcut: '/fa2i-logo.jpg',
    apple: '/fa2i-logo.jpg',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
