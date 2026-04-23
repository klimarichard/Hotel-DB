import type { ButtonHTMLAttributes } from "react";
import styles from "./IconButton.module.css";

type Variant = "close";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  "aria-label": string;
}

export default function IconButton({
  variant = "close",
  className,
  type = "button",
  children,
  ...rest
}: Props) {
  const classes = [
    styles.iconButton,
    styles[variant],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
