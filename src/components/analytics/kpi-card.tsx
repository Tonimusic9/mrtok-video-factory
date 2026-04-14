"use client";

import { type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  iconColor?: string;
  loading?: boolean;
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  subtitle,
  iconColor = "text-primary",
  loading = false,
}: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="bg-surface border-border hover:bg-surface-hover transition-colors">
        <CardContent className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-elevated",
              iconColor,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            {loading ? (
              <div className="mt-1 space-y-1.5">
                <div className="h-7 w-24 animate-pulse rounded bg-surface-elevated" />
                {subtitle !== undefined && (
                  <div className="h-3 w-16 animate-pulse rounded bg-surface-elevated" />
                )}
              </div>
            ) : (
              <>
                <p className="font-tabular text-2xl font-semibold leading-tight text-foreground">
                  {typeof value === "number"
                    ? value.toLocaleString("pt-BR")
                    : value}
                </p>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function KpiCardSkeleton() {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="flex items-center gap-4">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-surface-elevated" />
        <div className="min-w-0 space-y-2">
          <div className="h-3 w-20 animate-pulse rounded bg-surface-elevated" />
          <div className="h-7 w-28 animate-pulse rounded bg-surface-elevated" />
        </div>
      </CardContent>
    </Card>
  );
}
