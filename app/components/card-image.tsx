"use client";

import Image from "next/image";
import type { ComponentProps } from "react";

type CardImageProps = Omit<
  ComponentProps<typeof Image>,
  "decoding" | "height" | "loading" | "src" | "unoptimized" | "width"
> & {
  alt: string;
  src: string;
  width?: number;
  height?: number;
};

export default function CardImage({
  src,
  alt,
  width = 480,
  height = 680,
  ...props
}: CardImageProps) {
  return (
    <Image
      {...props}
      alt={alt}
      src={src}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      unoptimized
    />
  );
}
