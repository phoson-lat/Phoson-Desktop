"use client"

import { useRef, useState, useEffect } from "react"

type AnimatedTitleProps = {
  title: string
  className?: string
}

/**
 * Renders a title animating each word in with a staggered blur-in effect
 * (reuses the existing `animate-flow-token` keyframe) whenever the title changes.
 */
export function AnimatedTitle({ title, className }: AnimatedTitleProps) {
  const prevTitleRef = useRef<string>(title)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    if (title !== prevTitleRef.current) {
      prevTitleRef.current = title
      setAnimKey((k) => k + 1)
    }
  }, [title])

  const words = title.split(" ")

  return (
    <span className={className}>
      {words.map((word, i) => (
        <span
          key={`${animKey}-${i}`}
          className="inline-block animate-flow-token"
          style={{ animationDelay: `${i * 50}ms`, animationDuration: "0.4s", animationFillMode: "both" }}
        >
          {word}
          {i < words.length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </span>
  )
}
