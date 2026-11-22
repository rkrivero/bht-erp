import {
  SkeletonCards,
  SkeletonKpiStrip,
  SkeletonTable,
} from "@/components/ui/Skeleton";

export default function SociosLoading() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-bht-surface-cool px-4 py-6 sm:px-6 md:px-8 space-y-6"
    >
      <SkeletonKpiStrip count={4} />
      <SkeletonCards count={2} />
      <SkeletonTable rows={6} cols={5} />
    </main>
  );
}
