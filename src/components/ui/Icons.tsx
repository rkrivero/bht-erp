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

export function HorizonLogo({
  className = "h-7 w-16",
  "aria-label": ariaLabel = "Blue Horizon Trade",
  ...props
}: IconProps) {
  return (
    <svg
      viewBox="105 197 1240 446"
      className={className}
      {...getIconA11yProps({ ...props, "aria-label": ariaLabel })}
    >
      <g>
        <path
          d="M 815 291 L 1052 214 L 1052 444 L 998 427 L 998 361 Z"
          fill="#6B938C"
          stroke="#FFFFFF"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <path
          d="M 525 386 L 804 297 L 804 374 L 525 452 Z"
          fill="#112D42"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <path
          d="M 324 485 L 482 439 L 482 538 L 324 562 Z"
          fill="#112D42"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <path
          d="M 814 301 L 996 360 L 996 427 L 814 372 Z"
          fill="#235B73"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <path
          d="M 488 464 L 829 370 L 829 534 L 488 539 Z"
          fill="#235B73"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <path
          d="M 835 380 L 1040 445 L 835 539 Z"
          fill="#112D42"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <path
          d="M 871 495 L 1093 439 L 1093 566 L 871 540 Z"
          fill="#C87D55"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <path
          d="M 1100 440 L 1159 469 L 1159 579 L 1100 565 Z"
          fill="#A35C36"
          stroke="#FFFFFF"
          strokeWidth="6.0"
          strokeLinejoin="round"
        />
        <g stroke="#112D42" strokeLinecap="butt" fill="none" opacity="0.35">
          <path d="M 508 469.5 L 508 527.7" strokeWidth="5" />
          <path d="M 528 464.0 L 528 527.4" strokeWidth="5" />
          <path d="M 548 458.5 L 548 527.1" strokeWidth="5" />
          <path d="M 568 453.0 L 568 526.8" strokeWidth="5" />
          <path d="M 588 447.5 L 588 526.5" strokeWidth="5" />
          <path d="M 608 442.0 L 608 526.2" strokeWidth="5" />
          <path d="M 628 436.5 L 628 525.9" strokeWidth="5" />
          <path d="M 648 431.0 L 648 525.6" strokeWidth="5" />
          <path d="M 668 425.5 L 668 525.3" strokeWidth="5" />
          <path d="M 688 420.0 L 688 525.0" strokeWidth="5" />
          <path d="M 708 414.5 L 708 524.7" strokeWidth="5" />
          <path d="M 728 409.0 L 728 524.4" strokeWidth="5" />
          <path d="M 748 403.5 L 748 524.1" strokeWidth="5" />
          <path d="M 768 398.0 L 768 523.8" strokeWidth="5" />
          <path d="M 788 392.5 L 788 523.5" strokeWidth="5" />
          <path d="M 808 387.0 L 808 523.2" strokeWidth="5" />
          <path d="M 835 317.8 L 835 369.3" strokeWidth="5" />
          <path d="M 851 323.0 L 851 374.2" strokeWidth="5" />
          <path d="M 867 328.2 L 867 379.0" strokeWidth="5" />
          <path d="M 883 333.4 L 883 383.8" strokeWidth="5" />
          <path d="M 899 338.5 L 899 388.7" strokeWidth="5" />
          <path d="M 915 343.7 L 915 393.5" strokeWidth="5" />
          <path d="M 931 348.9 L 931 398.3" strokeWidth="5" />
          <path d="M 947 354.1 L 947 403.2" strokeWidth="5" />
          <path d="M 963 359.3 L 963 408.0" strokeWidth="5" />
          <path d="M 979 364.5 L 979 412.8" strokeWidth="5" />
          <path d="M 892 500.7 L 892 533.5" strokeWidth="4.6" />
          <path d="M 910 496.2 L 910 535.6" strokeWidth="4.6" />
          <path d="M 928 491.6 L 928 537.7" strokeWidth="4.6" />
          <path d="M 946 487.1 L 946 539.8" strokeWidth="4.6" />
          <path d="M 964 482.6 L 964 541.9" strokeWidth="4.6" />
          <path d="M 982 478.0 L 982 544.0" strokeWidth="4.6" />
          <path d="M 1000 473.5 L 1000 546.1" strokeWidth="4.6" />
          <path d="M 1018 469.0 L 1018 548.2" strokeWidth="4.6" />
          <path d="M 1036 464.4 L 1036 550.3" strokeWidth="4.6" />
          <path d="M 1054 459.9 L 1054 552.4" strokeWidth="4.6" />
          <path d="M 1072 455.3 L 1072 554.5" strokeWidth="4.6" />
          <path d="M 1112 455.9 L 1112 559.6" strokeWidth="4" />
          <path d="M 1129 464.3 L 1129 563.3" strokeWidth="4" />
          <path d="M 1145 472.1 L 1145 566.8" strokeWidth="4" />
        </g>
        <path
          d="M 130 626 C 410 494 980 493 1280 625 C 991 539 412 537 130 626 Z"
          fill="#112D42"
        />
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
