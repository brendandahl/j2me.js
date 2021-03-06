EXCLUDED="./support/*"

ifeq ($(JSR_256),0)
EXCLUDED += \
  "./javax/microedition/sensor/*" \
  "./midlets/Cottage360/*" \
  $(NULL)
endif

ifeq ($(JSR_179),0)
EXCLUDED += "./javax/microedition/location/*"
endif

SRCS=$(shell find . $(foreach path,$(EXCLUDED),-not -path $(path)) -name "*.java")
JASMIN_SRCS=$(shell find . -name "*.j")

BUILDTIME_SUPPORT_DIR=support/buildtime
RUNTIME_SUPPORT_DIR=support/runtime
BUILDTIME_SUPPORT_SRCS=$(shell find $(BUILDTIME_SUPPORT_DIR) -name "*.java")
RUNTIME_SUPPORT_SRCS=$(shell find $(RUNTIME_SUPPORT_DIR) -name "*.java")
PACKAGE_FILES = \
  tests.jar \
  gnu/testlet/vm/test.png \
  gfx/images/* \
  midlets/test.png \
  midlets/favouriteartists/images/* \
  midlets/blogwriter/images/* \
  midlets/rlinks/images/* \
  midlets/MediaSampler/res/* \
  com/sun/cldc/io/utf8.txt \
  org/mozilla/io/test.jpg \
  javax/microedition/media/hello.wav \
  javax/microedition/media/audio.3gp \
  javax/microedition/media/audio.amr \
  javax/microedition/media/hello.ogg \
  javax/microedition/media/test.webm \
  $(NULL)

ifeq ($(JSR_256),1)
PACKAGE_FILES += midlets/Cottage360/res/*
endif

all: tests.jar

../java/classes.jar:
	cd ../java && make

javax/microedition/media/test.webm: gfx/images/red.png
	ffmpeg -loop 1 -i gfx/images/red.png -t 10 javax/microedition/media/test.webm

Testlets.java: $(SRCS) $(JASMIN_SRCS) Makefile
	@echo "public class Testlets {" > $@
	@echo "  static String[] list = {" >> $@
	@grep "implements Testlet" $(SRCS) | sed -e "s/^.\///" -e "s/\.java.*//" -e "s/\(.*\)/\"\1\",/" >> $@
	@grep "implements gnu/testlet/Testlet" `find . -name "*.j"` | sed -e "s/^.\///" -e "s/\.j.*//" -e "s/\(.*\)/\"\1\",/" >> $@
	@echo "  null};" >> $@
	@echo "};" >> $@

MIDletTestlets.java: $(SRCS) Makefile
	@echo "public class MIDletTestlets {" > $@
	@echo "  static String[] list = {" >> $@
	@grep "implements MIDletTestlet" $(SRCS) | sed -e "s/^.\///" -e "s/\.java.*//" -e "s/\(.*\)/\"\1\",/" >> $@
	@echo "  null};" >> $@
	@echo "};" >> $@

tests.jar: $(SRCS) $(JASMIN_SRCS) Testlets.java MIDletTestlets.java
	rm -rf build
	mkdir build
	# Build the buildtime support classes in-place, not in ./build, so they aren't available at runtime.
	javac -source 1.3 -target 1.3 -encoding UTF-8 -bootclasspath ../java/classes.jar -extdirs "" $(BUILDTIME_SUPPORT_SRCS) > /dev/null
	javac -source 1.3 -target 1.3 -encoding UTF-8 -bootclasspath ../java/classes.jar -cp $(BUILDTIME_SUPPORT_DIR) -extdirs "" -d ./build $(SRCS) > /dev/null
	javac -source 1.3 -target 1.3 -encoding UTF-8 -bootclasspath ../java/classes.jar -extdirs "" -d ./build $(RUNTIME_SUPPORT_SRCS) > /dev/null
	java -jar ../tools/jasmin-2.4/jasmin.jar -d build/ $(JASMIN_SRCS)
	jar cfe tests.jar RunTests -C build/ .
	jar uf $(PACKAGE_FILES) > /dev/null
	# Create JARs for JARStore tests
	jar cf compressed.jar build/RunTests.class
	jar cf0 uncompressed.jar build/RunTests.class
	rm -rf build

clean:
	rm -f `find . -name "*.jar" -or -name "*~" -or -name "*.class"` Testlets.java
