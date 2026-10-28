import Image from "next/image";

// A phone screenshot in a plain ink bezel. The frame is only a border, so
// the capture stays the thing you look at. width/height are the file's own,
// which reserves the space before the image loads.

const SIZES = "(min-width: 640px) 17rem, 45vw";

export const phoneBezel = "rounded-[1.75rem] bg-[var(--ink)] p-[5px]";

export default function PhoneFrame({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <div className={phoneBezel}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={SIZES}
        className="block w-full h-auto rounded-[1.4rem]"
      />
    </div>
  );
}
