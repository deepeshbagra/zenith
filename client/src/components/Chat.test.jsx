import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import Chat from "./Chat";

const message = (overrides = {}) => ({
  id: "m1",
  name: "Bob",
  text: "hello",
  timestamp: "2024-01-01T10:30:00.000Z",
  isOwn: false,
  ...overrides,
});

describe("Chat", () => {
  it("shows an empty state before any messages", () => {
    render(<Chat messages={[]} onSend={() => {}} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("labels other people's messages with their name but not your own", () => {
    render(
      <Chat
        messages={[
          message({ id: "m1", name: "Bob", text: "hi there" }),
          message({ id: "m2", name: "You", text: "hey", isOwn: true }),
        ]}
        onSend={() => {}}
      />
    );

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
    expect(screen.getByText("hey")).toBeInTheDocument();
    // Your own messages are already visually distinct, so repeating your name
    // on every bubble is noise.
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("sends the trimmed draft and clears the input", () => {
    const onSend = jest.fn();
    render(<Chat messages={[]} onSend={onSend} />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "  spaced out  " } });
    fireEvent.click(screen.getByLabelText(/send message/i));

    expect(onSend).toHaveBeenCalledWith("spaced out");
    expect(input).toHaveValue("");
  });

  it("does not send a whitespace-only message", () => {
    const onSend = jest.fn();
    render(<Chat messages={[]} onSend={onSend} />);

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "   " } });

    // The button is disabled, so submit the form directly to prove the guard
    // holds even if the button is bypassed.
    fireEvent.submit(input.closest("form"));

    expect(onSend).not.toHaveBeenCalled();
  });
});
