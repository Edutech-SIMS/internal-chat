import { createContext, ReactNode, useContext, useState } from "react";

interface PushTokenContextType {
  token?: string;
  setToken: (t: string) => void;
}

const PushTokenContext = createContext<PushTokenContextType>({
  token: undefined,
  setToken: () => {},
});

export const PushTokenProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string>();
  return (
    <PushTokenContext.Provider value={{ token, setToken }}>
      {children}
    </PushTokenContext.Provider>
  );
};

export const usePushToken = () => useContext(PushTokenContext);
