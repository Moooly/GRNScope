import { notFound } from "next/navigation";
import NetworkLab from "./NetworkLab";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <NetworkLab />;
}
