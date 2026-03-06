import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { DashboardContent } from "./dashboard-content";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/");

  const payload = await verifyJwt(token);
  if (!payload) redirect("/");

  const params = await searchParams;
  const tab = params.tab === "github" ? "github" : "sessions";

  return <DashboardContent username={payload.username} initialTab={tab} />;
}
