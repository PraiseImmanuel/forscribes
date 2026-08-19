import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Mic, Waypoints, Target, FileOutput, type LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
  to?: string; // present once the feature is actually built
}

const FEATURES: Feature[] = [
  {
    icon: Mic,
    title: "Transcription",
    description:
      "Batch-import audio, transcribe locally, clean up filler and pacing, export any transcript on its own.",
    phase: "Phase B",
    to: "/transcribe",
  },
  {
    icon: Waypoints,
    title: "Auto-grouping",
    description:
      "Pick a set of transcripts and cluster them by what they're actually about — content, not date.",
    phase: "Phase C",
    to: "/group",
  },
  {
    icon: Target,
    title: "Topic rating",
    description:
      "Define a topic and see how many transcripts relate to it, ranked 1–10 with a transparent rubric.",
    phase: "Phase D",
    to: "/topics",
  },
  {
    icon: FileOutput,
    title: "Export",
    description:
      "Turn a selection, a group, or a topic result into a Markdown, Word, or ZIP file ready for the manuscript.",
    phase: "Phase E",
    to: "/library",
  },
];

const gridVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.35 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export function FeatureGrid() {
  return (
    <motion.section
      className="feature-grid"
      variants={gridVariants}
      initial="hidden"
      animate="show"
    >
      {FEATURES.map((feature) => {
        const content = (
          <>
            <div className="feature-icon">
              <feature.icon size={20} strokeWidth={2} />
            </div>
            <div className="feature-copy">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
            <span className="feature-badge">
              {feature.to ? "Open →" : `${feature.phase} · coming soon`}
            </span>
          </>
        );

        const cardProps = {
          className: `feature-card${feature.to ? " feature-card-live" : ""}`,
          variants: cardVariants,
          whileHover: { y: -4 },
          transition: { type: "spring" as const, stiffness: 300, damping: 22 },
        };

        return feature.to ? (
          <motion.div key={feature.title} {...cardProps}>
            <Link to={feature.to} className="feature-card-link">
              {content}
            </Link>
          </motion.div>
        ) : (
          <motion.article key={feature.title} {...cardProps}>
            {content}
          </motion.article>
        );
      })}
    </motion.section>
  );
}
