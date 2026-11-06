import { FEEDBACK_TAG_LABELS, type FeedbackTag } from "@convex/lib/constants";
import { Avatar } from "@/components/common/Avatar";
import { Badge } from "@/components/common/Badge";
import { Rating } from "@/components/common/Stars";
import { formatDate } from "@/lib/format";
import styles from "./FeedbackList.module.scss";

export interface FeedbackItem {
  id: string;
  rating: number;
  comment: string | null;
  tags: FeedbackTag[];
  direction: "BORROWER_TO_OWNER" | "OWNER_TO_BORROWER";
  createdAt: number;
  underReview: boolean;
  author: { name: string; imageUrl: string | null } | null;
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  if (items.length === 0) return <p className={styles.empty}>No reviews yet.</p>;
  return (
    <ul className={styles.list}>
      {items.map((f) => (
        <li key={f.id}>
          <div className={styles.head}>
            {f.author && <Avatar name={f.author.name} src={f.author.imageUrl} size={24} />}
            <span className={styles.author}>{f.author?.name ?? "Former member"}</span>
            <span className={styles.role}>{f.direction === "BORROWER_TO_OWNER" ? "borrowed from them" : "lent to them"}</span>
            <span className={styles.date}>{formatDate(f.createdAt, true)}</span>
          </div>
          <Rating value={f.rating} />
          {f.comment && <p className={styles.comment}>{f.comment}</p>}
          <div className={styles.tags}>
            {f.tags.map((t) => (
              <span key={t}>{FEEDBACK_TAG_LABELS[t]}</span>
            ))}
            {f.underReview && <Badge tone="warn">Under review</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}
