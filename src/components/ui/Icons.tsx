import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Defaults decorative icons to `aria-hidden="true"` unless callers explicitly
 * override `aria-hidden` or supply a semantic `aria-label`.
 */
function getIconA11yProps({
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  ...rest
}: Omit<IconProps, "className">): React.SVGProps<SVGSVGElement> {
  if (ariaLabel !== undefined && ariaHidden === undefined) {
    return {
      role: rest.role ?? "img",
      "aria-label": ariaLabel,
      ...rest,
    };
  }
  return {
    "aria-hidden": ariaHidden ?? true,
    ...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {}),
    ...rest,
  };
}

export function HorizonLogo({ className = "h-7 w-7", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 160 160" className={className} {...getIconA11yProps(props)}>
      <g transform="translate(80.00,123.65) scale(1.0104)">
        <path fill="#1c2127" d="M0.00 0.00 L69.28 -40.00 L0.00 -80.00 L-69.28 -40.00 Z" />
        <path fill="#1c2127" fillRule="evenodd" d="M0.00 0.00 L-69.28 -40.00 L-69.28 -30.40 L0.00 9.60 Z M-11.09 -3.71 L-24.94 -11.71 L-24.94 -6.53 L-11.09 1.47 Z M-44.34 -22.91 L-58.20 -30.91 L-58.20 -25.73 L-44.34 -17.73 Z" />
        <path fill="#1c2127" fillRule="evenodd" d="M0.00 0.00 L69.28 -40.00 L69.28 -30.40 L0.00 9.60 Z M11.09 -3.71 L24.94 -11.71 L24.94 -6.53 L11.09 1.47 Z M44.34 -22.91 L58.20 -30.91 L58.20 -25.73 L44.34 -17.73 Z" />
        <path fill="#FFFFFF" d="M-34.64 -60.00 L-3.46 -78.00 L-34.64 -96.00 L-65.82 -78.00 Z" />
        <path fill="#D0D3D5" fillRule="evenodd" d="M-34.64 -24.00 L-65.82 -42.00 L-65.82 -78.00 L-34.64 -60.00 Z M-37.84 -30.88 L-39.24 -31.70 L-39.24 -57.62 L-37.84 -56.80 Z M-42.51 -33.59 L-43.92 -34.40 L-43.92 -60.31 L-42.51 -59.51 Z M-47.19 -36.28 L-48.59 -37.09 L-48.59 -63.02 L-47.19 -62.20 Z M-51.87 -38.98 L-53.27 -39.79 L-53.27 -65.72 L-51.87 -64.91 Z M-56.54 -41.68 L-57.95 -42.49 L-57.95 -68.41 L-56.54 -67.60 Z M-61.22 -44.38 L-62.62 -45.20 L-62.62 -71.12 L-61.22 -70.31 Z" />
        <path fill="#9B9B9B" fillRule="evenodd" d="M-34.64 -24.00 L-3.46 -42.00 L-3.46 -78.00 L-34.64 -60.00 Z M-31.45 -30.88 L-30.04 -31.70 L-30.04 -57.62 L-31.45 -56.80 Z M-26.77 -33.59 L-25.37 -34.40 L-25.37 -60.31 L-26.77 -59.51 Z M-22.09 -36.28 L-20.69 -37.09 L-20.69 -63.02 L-22.09 -62.20 Z M-17.42 -38.98 L-16.01 -39.79 L-16.01 -65.72 L-17.42 -64.91 Z M-12.74 -41.68 L-11.34 -42.49 L-11.34 -68.41 L-12.74 -67.60 Z M-8.06 -44.38 L-6.66 -45.20 L-6.66 -71.12 L-8.06 -70.31 Z" />
        <path fill="#0b385f" d="M34.64 -60.00 L65.82 -78.00 L34.64 -96.00 L3.46 -78.00 Z" />
        <path fill="#07253f" fillRule="evenodd" d="M34.64 -24.00 L3.46 -42.00 L3.46 -78.00 L34.64 -60.00 Z M31.45 -30.88 L30.04 -31.70 L30.04 -57.62 L31.45 -56.80 Z M26.77 -33.59 L25.37 -34.40 L25.37 -60.31 L26.77 -59.51 Z M22.09 -36.28 L20.69 -37.09 L20.69 -63.02 L22.09 -62.20 Z M17.42 -38.98 L16.01 -39.79 L16.01 -65.72 L17.42 -64.91 Z M12.74 -41.68 L11.34 -42.49 L11.34 -68.41 L12.74 -67.60 Z M8.06 -44.38 L6.66 -45.20 L6.66 -71.12 L8.06 -70.31 Z" />
        <path fill="#1c2127" fillRule="evenodd" d="M34.64 -24.00 L65.82 -42.00 L65.82 -78.00 L34.64 -60.00 Z M37.84 -30.88 L39.24 -31.70 L39.24 -57.62 L37.84 -56.80 Z M42.51 -33.59 L43.92 -34.40 L43.92 -60.31 L42.51 -59.51 Z M47.19 -36.28 L48.59 -37.09 L48.59 -63.02 L47.19 -62.20 Z M51.87 -38.98 L53.27 -39.79 L53.27 -65.72 L51.87 -64.91 Z M56.54 -41.68 L57.95 -42.49 L57.95 -68.41 L56.54 -67.60 Z M61.22 -44.38 L62.62 -45.20 L62.62 -71.12 L61.22 -70.31 Z" />
        <path fill="#3373b0" d="M0.00 -40.00 L31.18 -58.00 L0.00 -76.00 L-31.18 -58.00 Z" />
        <path fill="#245582" fillRule="evenodd" d="M0.00 -4.00 L-31.18 -22.00 L-31.18 -58.00 L0.00 -40.00 Z M-3.20 -10.89 L-4.60 -11.70 L-4.60 -37.62 L-3.20 -36.80 Z M-7.87 -13.59 L-9.28 -14.40 L-9.28 -40.31 L-7.87 -39.51 Z M-12.55 -16.29 L-13.95 -17.09 L-13.95 -43.02 L-12.55 -42.20 Z M-17.23 -18.98 L-18.63 -19.80 L-18.63 -45.72 L-17.23 -44.91 Z M-21.90 -21.69 L-23.30 -22.49 L-23.30 -48.41 L-21.90 -47.61 Z M-26.58 -24.38 L-27.98 -25.20 L-27.98 -51.12 L-26.58 -50.30 Z" />
        <path fill="#0b385f" fillRule="evenodd" d="M0.00 -4.00 L31.18 -22.00 L31.18 -58.00 L0.00 -40.00 Z M3.20 -10.89 L4.60 -11.70 L4.60 -37.62 L3.20 -36.80 Z M7.87 -13.59 L9.28 -14.40 L9.28 -40.31 L7.87 -39.51 Z M12.55 -16.29 L13.95 -17.09 L13.95 -43.02 L12.55 -42.20 Z M17.23 -18.98 L18.63 -19.80 L18.63 -45.72 L17.23 -44.91 Z M21.90 -21.69 L23.30 -22.49 L23.30 -48.41 L21.90 -47.61 Z M26.58 -24.38 L27.98 -25.20 L27.98 -51.12 L26.58 -50.30 Z" />
      </g>
    </svg>
  );
}

export function PlusIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M5 12h14" />
    </svg>
  );
}

export function SearchIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CloseIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function CheckIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function LogOutIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

export function ShoppingBagIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

export function WalletIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

export function PackageIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="m16.5 9.4-9-5.19" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" x2="12" y1="22" y2="12" />
    </svg>
  );
}

export function ReceiptIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </svg>
  );
}

export function ActivityIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function BarChartIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <line x1="12" x2="12" y1="20" y2="10" />
      <line x1="18" x2="18" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="16" />
    </svg>
  );
}

export function BuildingIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
    </svg>
  );
}

export function TruckIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  );
}

export function CalendarIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function AlertTriangleIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function FlameIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

export function DownloadIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

export function ClockIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

export function LockIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function EditIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TrashIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function EyeIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

export function UsersIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function MapPinIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function PhoneIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.81.32 1.6.59 2.36a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.72-1.16a2 2 0 0 1 2.11-.45c.76.27 1.55.47 2.36.59A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

export function NavigationIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...getIconA11yProps(props)}
    >
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}
