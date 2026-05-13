import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tabla comparativa de cotizaciones",
  description: "Generador local de Excel comparativo desde PDFs de proveedores."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
