import type { ComponentType, ReactNode } from "react";

export interface StudioNotificationsProps {
  position?: "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right" | "bottom-center";
  limit?: number;
}

export interface StudioNotificationData {
  title?: ReactNode;
  message: ReactNode;
  color?: string;
  autoClose?: number | false;
}

export const Notifications: ComponentType<StudioNotificationsProps>;

export const notifications: {
  show(notification: StudioNotificationData): string;
};
