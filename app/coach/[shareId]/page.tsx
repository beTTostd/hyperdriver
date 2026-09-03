import type { Metadata } from "next";
import CoachExperience from "./coach-experience";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modo treinador — Hyperdriver", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function CoachPage({ params }: { params: Promise<{ shareId: string }> }) { return <CoachExperience shareId={(await params).shareId} />; }
