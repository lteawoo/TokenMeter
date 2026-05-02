cask "tokenmeter" do
  version "0.1.5"
  sha256 "c063fe7c81bf803a2ec402c51826d0ec26e786ea54e66cb2e61a6833b6f4393d"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end
