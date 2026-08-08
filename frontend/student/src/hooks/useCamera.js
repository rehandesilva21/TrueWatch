import { useCallback, useRef, useState } from "react";

export function useCamera() {
    const streamRef = useRef(null);

    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);


    const waitForVideoElement = useCallback((videoRef) => {

        return new Promise((resolve, reject) => {

            let attempts = 0;

            const check = () => {

                if (videoRef.current) {
                    resolve(videoRef.current);
                    return;
                }

                attempts++;

                if (attempts > 300) {
                    reject(
                        new Error(
                            "Video element was not mounted"
                        )
                    );
                    return;
                }

                requestAnimationFrame(check);
            };

            check();

        });

    }, []);



    const start = useCallback(async (videoRef) => {

        try {

            setError(null);
            setReady(false);


            console.log("[Camera] Requesting camera");


            const stream =
                await navigator.mediaDevices.getUserMedia({

                    video: {
                        facingMode: "user",

                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        },

                        frameRate: {
                            ideal: 30
                        }

                    },

                    audio: false
                });



            streamRef.current = stream;



            const video =
                await waitForVideoElement(videoRef);



            video.srcObject = stream;


            await new Promise((resolve) => {

                video.onloadedmetadata = () => {
                    resolve();
                };

            });



            await video.play();



            await new Promise((resolve) => {

                if (video.readyState >= 3) {
                    resolve();
                }

                else {

                    video.onplaying = () => {
                        resolve();
                    };

                }

            });



            console.log(
                "[Camera] Ready",
                video.videoWidth,
                video.videoHeight
            );


            setReady(true);


            return video;


        }

        catch(err){

            console.error(
                "[Camera] Failed:",
                err
            );


            setError(err.message);

            throw err;

        }


    }, [waitForVideoElement]);



    const stop = useCallback(() => {


        if(streamRef.current){

            streamRef.current
                .getTracks()
                .forEach(track => {
                    track.stop();
                });


            streamRef.current = null;

        }


        setReady(false);


    }, []);



    return {

        start,
        stop,

        ready,
        error,

        stream: streamRef.current

    };

}