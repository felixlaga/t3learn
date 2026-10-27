import { LearningWorkspace } from "@/components/learning-workspace";
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ goal?: string; afterReview?: string; minutes?: string }> }) {
	const query = await searchParams;
	return <LearningWorkspace view="today" initialGoalId={typeof query.goal === "string" ? query.goal : undefined} initialMinutes={query.afterReview === "1" && Number.isInteger(Number(query.minutes)) && Number(query.minutes) >= 1 && Number(query.minutes) <= 240 ? Number(query.minutes) : undefined} afterReview={query.afterReview === "1"}/>;
}
