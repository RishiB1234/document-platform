import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const reportOnline = () => setOnline(true);
    const reportOffline = () => setOnline(false);
    window.addEventListener("online", reportOnline);
    window.addEventListener("offline", reportOffline);
    return () => {
      window.removeEventListener("online", reportOnline);
      window.removeEventListener("offline", reportOffline);
    };
  }, []);
  return online;
}
