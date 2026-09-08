// Declares a DIFFERENT `Foo` binding, so `Foo` is ambiguous at the barrel.
export const Foo = ({ title }: { title: string }) => <b className="from-b">{title}</b>;
export const OnlyB = ({ title }: { title: string }) => <b className="only-b">{title}</b>;
