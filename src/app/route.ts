import { sitePage } from "@/components/site/page";

export const dynamic = "force-static";

export function GET() {
    return sitePage("ar");
}
