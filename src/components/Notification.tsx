export interface NotificationMessage {
  message: string;
  type: "success" | "error" | "info";
}

interface NotificationProps {
  message: NotificationMessage;
}

const COLOR_MAP = {
  success: "green",
  error: "red",
  info: "cyan",
} as const;

export function Notification({ message }: NotificationProps) {
  return (
    <box paddingX={1}>
      <text>
        <span fg={COLOR_MAP[message.type]}>{message.message}</span>
      </text>
    </box>
  );
}
