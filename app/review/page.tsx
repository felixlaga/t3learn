import { LearningWorkspace } from "@/components/learning-workspace";
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
	const query = await searchParams;
	return <LearningWorkspace view="review" sourceChatId={typeof query.source === "string" ? query.source : undefined}/>;
}
